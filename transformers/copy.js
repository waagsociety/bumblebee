//simply copy the value
exports.transform = function (context, data) {
	var result = {};
	result.value = data;
	result.resultcode = ResultCode.OK;

	return result;
};
