const router = require('express').Router();
const auth = require('../middleware/auth');
const { allowRoles, ADMIN_ROLES } = require('../middleware/rbac');
const c = require('../controllers/users.controller');

// User management is Admin/Owner only. Users are deactivated, never deleted.
const canManage = allowRoles(...ADMIN_ROLES);

router.get('/', auth, canManage, c.list);
router.post('/', auth, canManage, c.create);
router.put('/:id', auth, canManage, c.update);
router.post('/:id/deactivate', auth, canManage, c.deactivate);
router.post('/:id/reactivate', auth, canManage, c.reactivate);
router.post('/:id/reset-password', auth, canManage, c.adminResetPassword);

module.exports = router;
