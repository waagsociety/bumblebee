//test subject
var bb = require('../bb.js');

//test create table statement
exports.testCreateTable = function(test){
	
	var def = {
		"$schema": "http://json-schema.org/draft-04/schema#",
		"description": "An organisation in the TNL database",
		"properties": {
			"id": {
				"description": "The unique identifier for an organisation",
				"type": "integer"
			},
			"name": {
				"description": "Name of the organisation",
				"type": "string"
			},
		},
		"required": [
			"id",
			"name" ],
		"title": "tnl.organisation",
		"type": "object"
	};
	var expected = "CREATE TABLE IF NOT EXISTS tnl_organisation( id integer, name string );";

	var statement = bb.createTableStatement("tnl.organisation", def);
	test.ok(statement == expected, "create statement should be equal"); 	
	test.done();
}

//test create insert statement
exports.testCreateInsert = function(test){

	var object = {"id" : "23", "name" : "exists", "class" : "tnl.organisation"};

	var def = {
		"$schema": "http://json-schema.org/draft-04/schema#",
		"description": "An organisation in the TNL database",
		"properties": {
			"id": {
				"description": "The unique identifier for an organisation",
				"type": "integer"
			},
			"name": {
				"description": "Name of the organisation",
				"type": "string"
			},
		},
		"required": [
			"id",
			"name" ],
		"title": "tnl.organisation",
		"type": "object"
	};

	var expected = ("INSERT INTO tnl_organisation VALUES ( '23', 'exists' );");


	var statement = bb.createInsertStatement(object, def);
	test.ok(statement == expected, "insert statement should be equal"); 	
	test.done();

} 

//test the 'unique' transformer
//checks if the given value already exists in the cache for the specified field
exports.testUnique = function(test){

	//make sure we have some data to check
	setupUnique(function(db){

		var context = {"entity_name" : "tnl.organisation", "field_name" : "id", "db_cache" : this.db }
		
		var result = require('../transformers/unique.js').transform(context, 23);
		test.ok(result.value == undefined);
		test.ok(result.resultcode == ResultCode.DUPLICATE);
		
		context.field_name = "name";
		result = require('../transformers/unique.js').transform(context, "unique");

		test.ok(result.value == "unique");
		
		test.done();
		db.close();//clean up the test database
	});	
}

//test the transformation of one field
exports.testTransformField = function(test)
{
	//reuse the database
	setupUnique(function(db){
		var header = ["source"];
		var data = ["does_not_exist"];
		var context = {"entity_name" : "tnl.organisation", "field_name" : "name", "db_cache" : this.db }
		context.header = header;
		context.data = data;

		var field = {
			"input" : ["source"],
			"transformer" : ["unique", "copy", "join"] //test the chaining of transformers
		}

		var expected = {"resultcode" : ResultCode.OK, "name" : "does_not_exist"};
		var result = bb.transformField(context.field_name, field, context);

		test.ok(JSON.stringify(result) == JSON.stringify(expected), "should be equal"); 	
		test.done();
	});
}



//set up a database used for testing the unique transformer
function setupUnique(callback){
	var sqlite3 = require('sqlite3').verbose();
	db = new sqlite3.Database(":memory:");//create disposable test database
	db.serialize( function() {
		db.run("CREATE TABLE IF NOT EXISTS tnl_organisation( id integer, name string );");
		db.run("INSERT INTO tnl_organisation VALUES (23,'exists');");
		
		/*var select = "SELECT count(*) FROM tnl_organisation WHERE id  = '23';";	
		db.each(select, function(err, row) {
			console.log(row);
		});*/
	});
	callback(db);
}
