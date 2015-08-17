//simply copy the value
exports.transform = function (field_name, data) {
	if(data != undefined && data.constructor === Array && data.length > 0)
	{
		return data.join(",");
	}
	return data;
};
