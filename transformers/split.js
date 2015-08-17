//split the value to a list
//comma separated
exports.transform = function (context, data) {
	
	if( data != undefined && 
		data.constructor === Array 
		&& data[0] != undefined)
	{
		values = data[0].split(',');
	  	return {"flag": Flag.OK, "value" : values};
	}

	return {"flag": Flag.FAIL, "value" : data};
};
