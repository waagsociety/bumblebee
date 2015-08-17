//parse a date value 
exports.transform = function (context, data) {
	  var d = new Date(data); 
	  return d;
};
