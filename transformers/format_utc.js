//format a date value as utc
exports.transform = function (context, data) {
	return {"flag": Flag.OK, "value" : data.toISOString()};
};
