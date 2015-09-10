//check if it is really unique by lookup in the database with the fully qualified field_name
//callback is needed in case transformation take a while
//returns data if count was 0, returns undefined if duplicate
exports.transform = function (context, data, cb) {

	var db = context["db_cache"],
		tableName = context.entityName.replace(".","_"),
		columnName = context.fieldName;
	
	if(data != undefined && data.constructor === Array) {
		data = data[0];
		data = data.replace("'", "''");
	}

	var select = "SELECT count(*) as result FROM " + tableName + " WHERE " + columnName + " = ?;";

	db.get(select, data, function(err, row) {
		var result = {};
		
		if(err) {
			console.log("ERROR: ", err.stack)	
			result.resultcode = ResultCode.FAIL;
		} else {
			var count = row["result"],
				transformed = count > 0 ? undefined : data;

			result.value = transformed;

			if(transformed == undefined) {
				result.resultcode = ResultCode.DUPLICATE;
			} else {
				result.resultcode = ResultCode.OK;
			}
		}

		cb(err, result);
	});
};
