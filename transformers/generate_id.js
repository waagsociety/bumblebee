//generate random id
exports.transform = function (field_name, data) {
	//console.log("generating random id for " + field_name);  
	return Math.floor(Math.random() * 1000);
};
