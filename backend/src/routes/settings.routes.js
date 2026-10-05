const router = require('express').Router();
const auth = require('../middleware/auth');
const { allowRoles, ALL_ROLES, ADMIN_ROLES } = require('../middleware/rbac');
const c = require('../controllers/settings.controller');

router.get('/sync', auth, allowRoles(...ALL_ROLES), c.getSync);
router.put('/sync', auth, allowRoles(...ADMIN_ROLES), c.updateSync);

module.exports = router;
