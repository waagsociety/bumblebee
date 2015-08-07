//format a date value as utc
exports.transform = function (field_name, data) {
	return data.toISOString()
};
