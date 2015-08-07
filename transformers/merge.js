//merge all fields by joining with a space
exports.transform = function (field_name, data) {
	  return data.join(" ");
};
