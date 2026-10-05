const router = require('express').Router();
const auth = require('../middleware/auth');
const { allowRoles, ALL_ROLES } = require('../middleware/rbac');
const c = require('../controllers/sync.controller');

router.get('/status', auth, allowRoles(...ALL_ROLES), c.status);

module.exports = router;
