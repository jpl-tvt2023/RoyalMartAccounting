const router = require('express').Router();
const auth = require('../middleware/auth');
const { allowRoles, ALL_ROLES, ADMIN_ROLES } = require('../middleware/rbac');
const c = require('../controllers/audit.controller');

// Literal paths only, so order does not matter here -- but keep any future
// '/:id' after them (express 5 matches in order).
router.get('/', auth, allowRoles(...ADMIN_ROLES), c.list);
router.get('/facets', auth, allowRoles(...ADMIN_ROLES), c.facets);
router.get('/entity', auth, allowRoles(...ALL_ROLES), c.history);

module.exports = router;
