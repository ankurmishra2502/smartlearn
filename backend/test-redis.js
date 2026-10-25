const bcrypt = require("bcrypt");

(async () => {
  const hash = await bcrypt.hash("Test@123", 10);
  console.log(hash);
})();