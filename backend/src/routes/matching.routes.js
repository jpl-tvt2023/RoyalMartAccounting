const router = require('express').Router();
const auth = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const c = require('../controllers/matching.controller');

// Matching: who may do what is the matching.* permissions, set by an Admin or
// Owner on Admin -> Roles & permissions (Admin and Owner hold them all).
const view = requirePermission('matching.view');

router.get('/summary', auth, view, c.summary);
router.get('/results', auth, view, c.results);
router.get('/results/:kind/:id', auth, view, c.result);
router.get('/vouchers', auth, view, c.searchVouchers);
router.post('/run', auth, requirePermission('matching.run'), c.run);

const review = requirePermission('matching.review');
router.post('/results/:kind/:id/confirm', auth, review, c.confirm);
router.post('/results/:kind/:id/pick', auth, review, c.pick);
router.post('/results/:kind/:id/reject', auth, review, c.reject);
router.post('/results/:kind/:id/undo', auth, review, c.undo);

const rules = requirePermission('matching.rules');
router.get('/settings', auth, view, c.getSettings);
router.put('/settings', auth, rules, c.updateSettings);
router.post('/settings/reset', auth, rules, c.resetSettings);
router.post('/preview', auth, rules, c.preview);
router.get('/vendors', auth, view, c.vendors);
router.put('/vendors/:vendor', auth, rules, c.updateVendor);
router.get('/voucher-types', auth, view, c.voucherTypes);

router.get('/party-ledgers', auth, view, c.partyLedgers);
router.put('/party-ledgers/:companyId/:guid', auth, requirePermission('matching.parties'), c.updatePartyLedger);
router.post('/party-ledgers/accept-suggestions', auth, requirePermission('matching.parties'), c.acceptSuggestions);

module.exports = router;
