//simply copy the value
exports.transform = function (context, data) {
	var result = {};
	result.value = data;
	result.flag = Flag.OK;

	return result;
};
