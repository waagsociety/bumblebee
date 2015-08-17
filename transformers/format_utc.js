//format a date value as utc
exports.transform = function (context, data) {
	return data.toISOString()
};
