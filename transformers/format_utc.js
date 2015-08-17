//format a date value as utc
exports.transform = function (context, data) {
	return {"resultcode": ResultCode.OK, "value" : data.toISOString()};
};
