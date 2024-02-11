const express = require('express');

const app = express();

// Middleware function to set timeout for all POST requests
const timeoutMiddleware = (req, res, next) => {
  const TIMEOUT_DURATION = 1000;

  req.setTimeout(TIMEOUT_DURATION, () => {
    // Handle timeout
    res.status(408).send('Request Timeout');
  });

  next();
};

app.post('/_session', (req, res) => {
  res.set('Set-Cookie', 'AuthSession=abc123');
  res.status(200).send('OK');
});

app.get('/medic/_design/medic-client/_view/contacts_by_type_freetext', (req, res) => {
  const startkey = JSON.parse(req.query.startkey);
  console.log('contacts_by_type_freetext', startkey);
  const DATA = [
    // eslint-disable-next-line max-len
    { id: 'e847f6e2-6dba-46dd-8128-5b153d0cd75f', key: ['b_sub_county', 'name:malava'], value: 'false false b_sub_county malava', doc: { _id: 'e847f6e2-6dba-46dd-8128-5b153d0cd75f', _rev: '1-cd20b7095c20172237867233b0375eda', parent: { _id: '95d9abd1-7c17-41b1-af98-595509f96631' }, type: 'contact', is_name_generated: 'false', name: 'Malava', external_id: '', contact: { _id: '1e3d8375-6ab4-4409-be3f-3324db7658e9' }, contact_type: 'b_sub_county', reported_date: 1702573623984 } },
    // eslint-disable-next-line max-len
    { id: '2926bf4c-63eb-433d-a2b4-274fd05d2f1c', key: ['c_community_health_unit', 'name:chu'], value: 'false false c_community_health_unit chu', doc: { _id: '2926bf4c-63eb-433d-a2b4-274fd05d2f1c', _rev: '1-c15f26fe064f8357c19d1124286bf4c4', name: 'Chu', PARENT: 'Chepalungu', code: '123456', type: 'contact', contact_type: 'c_community_health_unit', parent: { _id: 'e847f6e2-6dba-46dd-8128-5b153d0cd75f', parent: { _id: '95d9abd1-7c17-41b1-af98-595509f96631' } }, contact: { _id: 'bb9ebc4c6af161ee0f53b42339001fb1' }, reported_date: 1701631255451 } }, 
  ];
  res.json({
    total_rows: 2,
    offset: 0,
    rows: DATA.filter(r => r.key[0] === startkey[0])
  });
});

app.use(timeoutMiddleware);

app.all('*', (req, res) => {
  setTimeout(() => {
    res.status(200).send('OK');
  }, 2000);
});

// Start the server
app.listen(3556, () => {
  console.log(`Server is listening on port ${3556}`);
});
