const router = require('express').Router();
const auth = require('../middleware/auth');
const { allowRoles, ALL_ROLES } = require('../middleware/rbac');
const { requirePermission } = require('../middleware/permission');
const c = require('../controllers/companies.controller');

// Everyone may see the companies. Turning their sync on or off takes the
// sync.companies permission (Admin/Owner, plus any role granted it).
router.get('/', auth, allowRoles(...ALL_ROLES), c.list);
router.patch('/:id', auth, requirePermission('sync.companies'), c.update);

module.exports = router;
