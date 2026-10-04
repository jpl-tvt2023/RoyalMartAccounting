// Every error response is { message }. 5xx messages are replaced so internal
// and database details never leak; intentional 4xx errors pass theirs through.
module.exports = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err.stack || err);

  const status = err.status || err.statusCode || 500;
  const message = status >= 500
    ? 'Internal server error'
    : (err.message || 'Request failed');

  res.status(status).json({ message });
};
