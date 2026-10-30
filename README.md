# Professor Stocks login

Ye project screenshot se inspired login/signup page aur ek chhota Node.js + SQLite backend hai. Account banane aur login karne ka flow kaam karta hai; passwords salted `scrypt` hash ke roop mein save hote hain. Market chart sirf design demo hai, live PSX data nahi.

## Chalane ka tareeqa

1. [Node.js](https://nodejs.org/) 22.13 ya us se naya install karein.
2. Is folder mein terminal khol kar `npm start` chalayein.
3. Browser mein `http://localhost:3001` kholein.
4. `Sign up` se account banayein, phir `Sign out` karke dobara login test karein.

`npm run dev` server ko development watch mode mein chalata hai. Pehli run par `data/app.sqlite` database khud ban jayega; `data/` folder delete na karein warna local accounts mit jayenge.

## Code kahan hai?

- `public/index.html`, `public/styles.css`, `public/app.js` — login/signup screen aur browser-side interaction.
- `server.js` — API routes, password hashing, session cookie aur SQLite setup.
- `data/app.sqlite` — local user accounts aur login sessions.

## Zaroori aglay steps

- Forgot-password link abhi email service ke baghair reset nahi bhejta. Isay production mein enable karne ke liye email provider aur one-time reset token flow add karein.
- Google sign-in abhi sirf setup message dikhata hai. Google OAuth client ID/secret aur callback route configure karna baaqi hai.
- Production mein HTTPS, secure cookie (`NODE_ENV=production`), backups, rate limiting, aur session cleanup/monitoring configure karein. Is demo server ko public internet par seedha deploy na karein.
