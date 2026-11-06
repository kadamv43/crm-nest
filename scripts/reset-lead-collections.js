// Clears every lead-related collection so the new contact structure starts clean.
//
// The lead data written before contacts existed has no `contact` reference, so
// it cannot be used with the new structure. Run this ONCE on a database whose
// lead data you do not need, before starting the new version:
//
//   CONFIRM_RESET=yes mongosh "<your mongodb uri>" --file scripts/reset-lead-collections.js
//
// It drops: leads, hotleads, userleads, userhotleads, contacts, leadactivities.
// Users, companies (branches), banks, incentives and everything else are kept.
// The new indexes (one contact per company and number, one pool entry per
// contact) are created automatically the next time the backend starts.

const collections = [
  'leads',
  'hotleads',
  'userleads',
  'userhotleads',
  'contacts',
  'leadactivities',
];

const confirmed = typeof process !== 'undefined' && process.env.CONFIRM_RESET === 'yes';

print('Database: ' + db.getName());
const existing = db.getCollectionNames();
collections.forEach((name) => {
  print(
    '  ' + name + ': ' + (existing.includes(name) ? db.getCollection(name).countDocuments({}) + ' documents' : '(does not exist)'),
  );
});

if (!confirmed) {
  print('');
  print('Nothing was deleted. To really drop these collections run again with CONFIRM_RESET=yes');
} else {
  collections.forEach((name) => {
    if (existing.includes(name)) {
      db.getCollection(name).drop();
      print('dropped ' + name);
    }
  });
  print('Done. Start the backend to create the new indexes.');
}
