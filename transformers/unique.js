//check if it is really unique by lookup in the database with the fully qualified field_name
//callback is needed in case transformation take a while
//returns data if count was 0, otherwise undefined
exports.transform = function (context, data) {

	var db = context["db_cache"];
	var table_name = context["entity_name"].replace(".","_");
	var column_name = context["field_name"];

	var select = "SELECT count(*) as result FROM " + table_name + " WHERE " + column_name + " = '" + data + "';";	
	var done = false;
	var result = undefined;

	//sqlite3 is all asynchronous	
	db.get(select, function(err, row) {
		var count = row["result"];
		var transformed = count > 0 ? undefined : data;
		result = transformed;
		done = true;
	});
	
	//to make the transformer synchronous
	require('deasync').loopWhile(function(){return !done;});

	return result;
};
