const router = require('express').Router();
const auth = require('../middleware/auth');
const { allowRoles, ALL_ROLES, ADMIN_ROLES } = require('../middleware/rbac');
const c = require('../controllers/companies.controller');

// Everyone may see the companies; only Admin/Owner turn their sync on or off.
router.get('/', auth, allowRoles(...ALL_ROLES), c.list);
router.patch('/:id', auth, allowRoles(...ADMIN_ROLES), c.update);

module.exports = router;
