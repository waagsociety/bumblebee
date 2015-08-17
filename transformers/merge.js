//merge all fields by joining with a space
exports.transform = function (context, data) {
	  return data.join(" ");
};
