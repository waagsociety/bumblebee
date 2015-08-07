//split the value to a list
//comma separated
exports.transform = function (field_name, data) {
	values = data[0].split(',');
	return values;
};
