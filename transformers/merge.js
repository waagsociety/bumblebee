//merge all fields by joining with a space
exports.transform = function (context, data) {
	return {"flag": Flag.OK, "value" : data.join(" ")};
};
