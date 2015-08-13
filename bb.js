#!/usr/bin/env node

var fs = require('fs'),
byline = require('byline'),
YAML = require('js-yaml'),
validate = require('jsonschema').validate,
csv = require('csv'),
sqlite3 = require('sqlite3').verbose();

//check if this file is being called as a script or as a module
if(module.parent == null)
{
	run();
}
else
{
	//export the functions we want to unit test here
	module.exports = {
	  createTableStatement: createTableStatement,
    	}
}

//run the script from command line arguments
function run()
{
	//read command line arguments
	var argv = require('optimist')
	.usage('Transform data according to a configuration and mapping file.\nUsage: $0')
	.demand(['c','m','d'])
	.alias('c', 'conf').alias('m', 'mapping').alias('d','data')
	.argv;

	//process schema definitions, create tables if necessary	
	var schema = YAML.safeLoad(fs.readFileSync(argv.c, 'utf8'));
	var db_name = argv.c + ".db";
	var db = new sqlite3.Database(argv.c + ".db");//create or open (R/W) the database for the provided schema file
	Object.keys(schema).forEach(function(e){
		var statement = createTableStatement(e, schema[e]);
		db.run(statement);
	});

	//load mappings and data
	var mapping = YAML.safeLoad(fs.readFileSync(argv.m, 'utf8'));
	var header = undefined;//the first line of data is expected to be a header 
	var stream = byline(fs.createReadStream(argv.d, { encoding: 'utf8' }));

	//start data processing
	stream.on('data', function(line) {
		if(header == undefined)
		{
			header = line.split(',');
		}
		else
		{
			csv.parse(line,function(err, output){ //async
				var context = 
				{
					"db_connection" : db,
					"schema" : schema,
					"mapping" : mapping,
					"header" : header,
					"data" : output[0] 
				};
				process(context);
			});
		}
	});
}

//create a table for each schema found in the definition
//initializes the context variable
function createTableStatement(entity_name, def)
{
	//reduce the properties in each schema definition to a single create statement
	var statement = Object.keys(def["properties"]).reduce(function(prev,cur){
		var field_name = cur; 
		var type = def["properties"][field_name]["type"];
		return prev + field_name + " " + type + ", ";

	},"CREATE TABLE IF NOT EXISTS " + entity_name.replace('.','_') + "( ");

	statement = statement.slice(0, - 2);
	statement += " );"
	return statement;
}

//process one row at a time, according to the specified mapping
//for each entity in the mapping file, transform the data, 
//validate the transformed data with the schema.
function process(context)
{
	var objects = context.mapping.map(function(e){ 
		
		var entity_name = Object.keys(e)[0];
		context.entity_name = entity_name;//save to context as well for use by transformer

		var entity = e[entity_name];
		var transformed = transformEntity(entity_name, entity, context);
		
		//schema for the given entity
		var def = context.schema[entity_name];
		
		//validate according to schema
		if(isValid(def, transformed)){
			transformed.class = entity_name; //inject this property for later use
			console.log("create: " + YAML.safeDump(transformed));
			return transformed;
		}
		else
		{
			//console.log('x');
		}
	});
	//todo: do something with these objects.. put them in the database or something
}

//transform the given entity and input values
//return one (or more) object that consists of key value pairs for each field
//or undefined if entity was not valid
function transformEntity(entity_name, entity, context)
{
	//map the fields to their transformed counterparts
	var fields = Object.keys(entity).map(function(f){
		var field_name  = f;
		var field = entity[f];
		return transformField(field_name, field, context);
	});

	//reduce the set of fields to an object
	return fields.reduce(function(obj, k) {
		var key = Object.keys(k)[0]; //first property
		obj[key] = k[key];
		return obj;
	}, {});
}

//execute the given chain of transformers and input values
//return a key value pair: field_name -> transformed value
function transformField(field_name, field, context)
{
	var columns = field.input;
	var data = undefined;

	if(columns != undefined)
	{
		//collect the input value
		data = columns.map(function(c){
			var index = context.header.indexOf(c);
			var value = context.data[index];
			return value;
		});
	}
	
	//get the transformer chain
	var chain = field.transformer;
	context.field_name = field_name;//save to context as well for use by transformer

	//execute the transformers chained together, input of the second is output of the first and so on.
	for(var key in chain)
	{
		try
		{
			var mod = "./transformers/" + chain[key] + ".js";
			data = require(mod).transform(context,data);
		}
		catch(e)
		{
			console.log(e.stack); //probably transformer not found..
		}
	}

	var key = field_name;
	var result = {};
	result[key] = data;
	return result;
}

//validates according to json-schema
function isValid(schema, object)
{
	var result = validate(object,schema);
	if(result.valid == false)
	{
		//console.log('x');
	}
	return result.valid;
}
