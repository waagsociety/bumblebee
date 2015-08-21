//unit test react components
var React = require('react');

//test hello world component
exports.testHello = function(test)
{
	//the class we want to test
	var Hello = require('../public/components/hello').Hello;
	var input = { name: 'World!' }; //with the provided input
	//should deliver the expected result:
	var expected = "<div>Hello World!</div>";

	var result = React.renderToStaticMarkup(React.createElement(Hello,input));
	
	test.ok(result == expected);
	test.done();
}

//test the schema -> entity props transformer
exports.testEntityTableProps = function(test)
{
	//input is the json-schema definition for an entity
	var input = {"tnl.organisation":{
			"$schema":"http://json-schema.org/draft-04/schema#",
			"title":"tnl.organisation",
			"description":"An organisation in the TNL database",
			"type":"object",
			"properties":{
				"id":{"description":"The unique identifier for an organisation","type":"string"},
				"name":{"description":"Name of the organisation","type":"string"},
				"address":{"description":"Address of the organisation","type":"string"},
				"type":{"description":"Type of the organisation.","type":"string"}},
			"required":["id","name"]
		}
	};

	var expected = {
		"title" : "tnl.organisation",
	       	"description" : "An organisation in the TNL database",
		"fields" : ["id", "name", "address", "type"],
		"entities" : [],
		"key" : "tnl.organisation"
	};
		
	var props = require('../public/components/entity_table').entityTableProps(input);
	
	test.ok(JSON.stringify(props) == JSON.stringify(expected));
	test.done();
}

exports.testEntityTable = function(test)
{
	var EntityTable = require('../public/components/entity_table').EntityTable;

	//input are the props based on the json-schema definition for an entity
	var props = {
		"title" : "tnl.organisation",
	       	"description" : "An organisation in the TNL database",
		"fields" : ["id", "name", "address", "type"],
		"entities" : [],
		"key" : "tnl.organisation"
	};
	
	//we expect an html table with a header based on the fields in the schema
	var expected = 
		"<table id=\"tnl.organisation\" class=\"formdata\">" + 
		"<caption>An organisation in the TNL database</caption>" + 
		"<tr id=\"header\">" + 
			"<th>id</th>" + 
			"<th>name</th>" + 
			"<th>address</th>" + 
			"<th>type</th>" + 
		"</tr></table>";

	var result = React.renderToStaticMarkup(React.createElement(EntityTable, props));

	test.ok(result == expected);
	test.done();
}

exports.testEntityRowProps = function(test)
{
	//input is a row of fields, including resultcodes, where resultcode indicates the validity of a the transformation
	var input = {
		"id":{"resultcode":0,"id":"4JNX4FQ20j"},
		"subject":{"resultcode":0,"subject":"/id/vg09llza0jzq/j_a_m_jan_hendrikx"},
		"object":{"resultcode":0,"object":"/cda.nl"},
		"type":{"resultcode":0,"type":"MEMBER_OF"},
		"span":{"resultcode":0,"span":"Null"},
		"class":"tnl.relation"
	};

	var expected = {
		"class" : "tnl.relation",
		"columns" : ["id", "subject", "object", "type", "span"],
		"values" : ["4JNX4FQ20j", "/id/vg09llza0jzq/j_a_m_jan_hendrikx", "/cda.nl", "MEMBER_OF", "Null"],
		"status" : [0,0,0,0,0],
		"key" : "4JNX4FQ20j"
	};
	
	var props = require('../public/components/entity_row').entityRowProps(input);

	test.ok(JSON.stringify(props) == JSON.stringify(expected));
	test.done();

}

exports.testEntityRow = function(test)
{
	//the class we want to test
	var EntityRow = require('../public/components/entity_row').EntityRow;

	//props based on transformed input
	var props = {
		"class" : "tnl.relation",
		"columns" : ["id", "subject", "object", "type", "span"],
		"values" : ["4JNX4FQ20j", "/id/vg09llza0jzq/j_a_m_jan_hendrikx", "/cda.nl", "MEMBER_OF", "Null"],//initial state
		"status" : [0,0,0,0,0],
		"key" : "4JNX4FQ20j"
	};
	
	var expected = "<tr>" + 
		"<td><input type=\"text\" name=\"id\" value=\"4JNX4FQ20j\"></td>" + 
		"<td><input type=\"text\" name=\"subject\" value=\"/id/vg09llza0jzq/j_a_m_jan_hendrikx\"></td>" + 
		"<td><input type=\"text\" name=\"object\" value=\"/cda.nl\"></td>" + 
		"<td><input type=\"text\" name=\"type\" value=\"MEMBER_OF\"></td>" + 
		"<td><input type=\"text\" name=\"span\" value=\"Null\"></td>" + 
	"</tr>";

	var result = React.renderToStaticMarkup(React.createElement(EntityRow, props));

	test.ok(result == expected);
	test.done();
}

//test entity row embedded in entity table
//since we have injected two entities into the "entities" property of the props object of the table
exports.testEntityTableRow = function(test)
{
	var EntityTable = require('../public/components/entity_table').EntityTable;

	//input are the props based on the json-schema definition for an entity
	var props = {
		"title" : "tnl.organisation",
	       	"description" : "An organisation in the TNL database",
		"fields" : ["id", "name", "address", "type"],
		"entities" : [
			{
				"class" : "tnl.organisation",
				"columns" : ["id", "name", "address", "type"],
				"values" : ["4JNX4FQ20k", "VVD", null, "POLITICAL_PARTY"],//initial state
				"status" : [0,0,0,0,0],
				"key" : "4JNX4FQ20k"
			},
			{
				"class" : "tnl.organisation",
				"columns" : ["id", "name", "address", "type"],
				"values" : ["4JNX4FQ20j", "CDA", null, "POLITICAL_PARTY"],//initial state
				"status" : [0,0,0,0,0],
				"key" : "4JNX4FQ20j"
			}
		]
	};
	
	//we expect an html table with a header based on the fields in the schema

	var expected = "<table id=\"tnl.organisation\" class=\"formdata\">" + 
		"<caption>An organisation in the TNL database</caption>" + 
		"<tr id=\"header\">" + 
			"<th>id</th>" + 
			"<th>name</th>" + 
			"<th>address</th>" + 
			"<th>type</th>" + 
		"</tr>" + 
		"<tr>" + 
			"<td><input type=\"text\" name=\"id\" value=\"4JNX4FQ20k\"></td>" + 
			"<td><input type=\"text\" name=\"name\" value=\"VVD\"></td>" + 
			"<td><input type=\"text\" name=\"address\"></td>" + 
			"<td><input type=\"text\" name=\"type\" value=\"POLITICAL_PARTY\"></td>" + 
		"</tr>" + 
		"<tr>" + 
			"<td><input type=\"text\" name=\"id\" value=\"4JNX4FQ20j\"></td>" + 
			"<td><input type=\"text\" name=\"name\" value=\"CDA\"></td>" + 
			"<td><input type=\"text\" name=\"address\"></td>" + 
			"<td><input type=\"text\" name=\"type\" value=\"POLITICAL_PARTY\"></td>" + 
		"</tr>" + 
		"</table>";
	var result = React.renderToStaticMarkup(React.createElement(EntityTable, props));

	test.ok(result == expected);
	test.done();
}
