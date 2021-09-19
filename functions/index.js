exports.startCodeServer = (req, res) => {
  const message = 'Hello World!';
  res.status(200).send(message);
};