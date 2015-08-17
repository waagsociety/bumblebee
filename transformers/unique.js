//check if it is really unique by lookup in the database with the fully qualified field_name
//callback is needed in case transformation take a while
//returns data if count was 0, returns undefined if duplicate
exports.transform = function (context, data) {

	var db = context["db_cache"];
	var table_name = context["entity_name"].replace(".","_");
	var column_name = context["field_name"];
	
	if(data != undefined && data.constructor === Array)
	{
		data = data[0];
		data = data.replace("'", "''");
		console.log(data);
	}

	var select = "SELECT count(*) as result FROM " + table_name + " WHERE " + column_name + " = ?;";	
	var done = false;
	
	var result = {};
	result.flag = Flag.FAIL;

	//sqlite3 is all asynchronous	
	db.get(select,data,function(err, row) {
		if(err){
			console.log("ERROR: ", err.stack)
		}
		else{
			var count = row["result"];
			var transformed = count > 0 ? undefined : data;
			result.value = transformed;
			if(transformed == undefined)
			{
				result.flag = Flag.DUPLICATE;
			}
			else
			{
				result.flag = Flag.OK;
			}
		}
		done = true;
	});

	
	//to make the transformer synchronous
	require('deasync').loopWhile(function(){return !done;});

	return result;
};
