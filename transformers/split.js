//split the value to a list
//comma separated
exports.transform = function (context, data) {
	
	if( data != undefined && 
		data.constructor === Array 
		&& data[0] != undefined)
	{
		values = data[0].split(',');
		return values;
	}
	return data;
};
