const { searchTcas } = require("./handlers/autoreply/tcas-search");

const results = searchTcas("kumusta ka palawan", 5);

console.log("Results:", results.length);
console.log(results);
