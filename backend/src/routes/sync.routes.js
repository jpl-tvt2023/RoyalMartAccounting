const router = require('express').Router();
const auth = require('../middleware/auth');
const { allowRoles, ALL_ROLES } = require('../middleware/rbac');
const { requirePermission } = require('../middleware/permission');
const c = require('../controllers/sync.controller');

router.get('/status', auth, allowRoles(...ALL_ROLES), c.status);
router.get('/runs', auth, allowRoles(...ALL_ROLES), c.runs);
router.post('/now', auth, requirePermission('sync.run'), c.now);

module.exports = router;
