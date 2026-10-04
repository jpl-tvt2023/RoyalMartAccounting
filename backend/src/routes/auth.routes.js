const router = require('express').Router();
const auth = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const c = require('../controllers/auth.controller');

router.post('/login', loginLimiter, c.login);
router.post('/refresh', c.refresh);
// The three routes a user with a forced password change may still reach
// (middleware/auth.js PASSWORD_CHANGE_ROUTES).
router.get('/me', auth, c.me);
router.post('/change-password', auth, c.changePassword);
router.post('/logout', auth, c.logout);

module.exports = router;
