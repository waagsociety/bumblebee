//split the value to a list
//comma separated
exports.transform = function (field_name, data) {
	
	if(data[0] != undefined)
	{
		values = data[0].split(',');
		return values;
	}
	return data;
};
