const admin = require('firebase-admin');
const axios = require('axios');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  } catch (error) {
    console.error('Firebase initialization error', error);
  }
}

const db = admin.firestore();

/* ---------- Telegram ---------- */
async function sendTelegramNotification(formData) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const message = `📢 New Contact Form Submission:\n\nName: ${formData.name}\nEmail: ${formData.email}\nMessage: ${formData.description.substring(0, 200)}...`;

  try {
    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Telegram notification error:', error);
  }
}

/* ---------- Gmail (Nodemailer) ---------- */
async function sendEmailNotification(formData) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  const mailOptions = {
    from: `"Website Contact Form" <${process.env.GMAIL_USER}>`,
    to: process.env.GMAIL_TO || process.env.GMAIL_USER,
    replyTo: formData.email,
    subject: `New Contact Form Submission from ${formData.name}`,
    text: `You received a new message from your website contact form.\n\nName: ${formData.name}\nEmail: ${formData.email}\nMessage:\n${formData.description}\n\nSubmitted: ${formData.timestamp}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #811318; margin-bottom: 20px;">New Contact Form Submission</h2>
        <p style="margin: 8px 0;"><strong>Name:</strong> ${formData.name}</p>
        <p style="margin: 8px 0;"><strong>Email:</strong> <a href="mailto:${formData.email}">${formData.email}</a></p>
        <p style="margin: 8px 0;"><strong>Submitted:</strong> ${formData.timestamp}</p>
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
        <p style="margin: 8px 0;"><strong>Message:</strong></p>
        <p style="white-space: pre-wrap; background: #f9f5f2; padding: 15px; border-radius: 8px;">${formData.description}</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Gmail notification sent successfully');
  } catch (error) {
    console.error('Gmail notification error:', error);
  }
}

/* ---------- Handler ---------- */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const data = req.body;

    if (!data.email || !data.name || !data.description) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // 1. Save to Firestore
    const docRef = await db.collection('contactSubmissions').add({
      ...data,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
      userAgent: req.headers['user-agent'] || null
    });

    // 2. Fire off notifications in parallel (non-blocking failures)
    await Promise.allSettled([
      sendTelegramNotification(data),
      sendEmailNotification(data)
    ]);

    return res.status(200).json({
      success: true,
      id: docRef.id
    });
  } catch (error) {
    console.error('Error submitting to Firestore:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
