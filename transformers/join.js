//join the values if inside array, otherwise copy the value
exports.transform = function (context, data) {
	var result = {};
	result.flag = Flag.OK;
		
	if(data != undefined && data.constructor === Array && data.length > 0)
	{
		result.value = data.join(",");
	}
	else
	{
		result.value = data;
	}

	return result;
};
