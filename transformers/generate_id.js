//generate a unique id, by means of the shortid npm module
exports.transform = function (context, data) {
	return {"resultcode": ResultCode.OK, "value" : require('shortid').generate()};
};
