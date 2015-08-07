//parse a date value 
exports.transform = function (field_name, data) {
	  var d = new Date(data); 
	  return d;
};
