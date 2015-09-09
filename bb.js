#!/usr/bin/env node

var fs = require('fs'),
	async = require('async'),
	byline = require('byline'),
	YAML = require('js-yaml'),
	validate = require('jsonschema').validate,
	csv = require('csv'),
	sqlite3 = require('sqlite3').verbose();

var log = false;

//Result resultcodes
ResultCode = {
	OK : 0, //transformation went okay, no errors
	FAIL : 1,//transformation failed
	DUPLICATE : 2 //transformation indicates duplicate key
}

//check if this file is being called as a script or as a module
if(module.parent == null) {
	run();
	log = true;
} else {
	//export the functions we want to expose here
	module.exports = {
	  transformField : transformField,
	  createTableStatement: createTableStatement,
	  createInsertStatement: createInsertStatement,
	  transformFile: transformFile
  	};
}

//run the script from command line arguments
function run() {
	//read command line arguments
	var argv = require('optimist')
	.usage('Transform data according to a configuration and mapping file.\nUsage: $0')
	.demand(['c','m','d'])
	.alias('c', 'conf').alias('m', 'mapping').alias('d','data')
	.argv;

	transformFile(argv.c, argv.m, argv.d, function(result){
		console.log(".");//one extra row was processed we can use this to update the server state for example 
	});
}

//start the streaming transformation process 
//provide paths to the configuration files and input
//callback is called at every transformed row
//this function may be called from web application for example
function transformFile(path_schema, path_mapping, path_data, callback) {
	var filesToRead = {},
		filesContents = {},
		context = {};

	filesToRead.path_schema = path_schema;
	filesToRead.path_mapping = path_mapping;

	async.each(Object.keys(filesToRead), function(key, cb){
		fs.readFile(filesToRead[key], 'utf8', function(err, contents){
			filesContents[key] = contents;
			cb(err);
		});
	}, function(err){
		if(err) return callback(err);

		//process schema definitions, create tables if necessary	
		var schema = YAML.safeLoad(filesContents.path_schema),
			db_name = path_schema + ".db",
			db_cache = new sqlite3.Database(path_schema + ".db");//create or open (R/W) the cache database for the provided schema file
		
		Object.keys(schema).forEach(function(e){
			var statement = createTableStatement(e, schema[e]);
			db_cache.run(statement);
		});

		//load mappings and data
		var mapping = YAML.safeLoad(filesContents.path_mapping);
		var stream = byline(fs.createReadStream(path_data, { encoding: 'utf8' }));
		var header = undefined;//the first line of data is expected to be a header 

		//start data processing
		stream.on('data', function(line) {
			if(header == undefined) {
				header = line.split(',');
				context.header = header;
				callback(null, { header: header });
			} else {
				csv.parse(line,function(err, output){ //async
					context.data = output[0];

					processRow(context, callback);
				});
			}
		});

		context.db_cache = db_cache;
		context.schema = schema;
		context.mapping = mapping;
	});

	return context;
}

//create a cache table for each schema found in the definition
//initializes the context variable
function createTableStatement(entity_name, def) {
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

//insert an object into the cache database
function createInsertStatement(object, def) {
	var statement = Object.keys(def["properties"]).reduce(function(prev,cur){
		var field_name = cur; 
		var value = object[field_name];
		if(value != undefined)
		{
			value = value.replace(/'/g,"''");//replace all single quotes with double single quotes
		}
		
		return prev + "'" + value  + "', ";

	},"INSERT INTO " + object.class.replace('.','_') + " VALUES ( ");

	statement = statement.slice(0, - 2);
	statement += " );"
	return statement;
}

//process one row at a time, according to the specified mapping
//for each entity in the mapping file, transform the data, 
//validate the transformed data with the schema.
function processRow(context, callback) {
	var objects = context.mapping.map(function(e){ 
		
		var entity_name = Object.keys(e)[0];
		context.entity_name = entity_name;//save to context as well for use by transformer

		var entity = e[entity_name];
		
		var transformed = transformEntity(entity_name, entity, context);
		
		//schema for the given entity
		var def = context.schema[entity_name];
		
		//validate according to schema
		if(isValid(def, transformed[0])){
			transformed[0].class = entity_name; //inject this property for later use
			transformed[1].class = entity_name; //inject this property for later use
			var insert = createInsertStatement(transformed[0], def);
			context.db_cache.run(insert);
			if(log){console.log("create: " + YAML.safeDump(transformed));}
			return transformed[1];
		} else {
			//console.log('x');//not valid
		}
	});
	
	objects = objects.filter(function(n){ return n != undefined });
	
	//only callback if we have something to pass back	
	if(objects.length > 0){
		callback(null, objects);
	}
}

//transform the given entity and input values
//return one (or more) object that consists of key value pairs for each field
//or undefined if entity was not valid
//returns two copies of the object:
//the first is used for validation
//the second contains resultcodes for each field
function transformEntity(entity_name, entity, context)
{
	//map the fields to their transformed counterparts
	var fields = Object.keys(entity).map(function(f){
		var field_name  = f;
		var field = entity[f];
		return transformField(field_name, field, context);
	});

	//reduce the set of fields to an object
	var object_to_validate =  fields.reduce(function(obj, k) {
		var key = Object.keys(k)[1]; //first property is resultcode, second is name of value 
		obj[key] = k[key];
		return obj;
	}, {});

	var object_annotated = fields.reduce(function(obj, k) {
		var key = Object.keys(k)[1]; //first property is resultcode, second is name of value 
		obj[key] = k;
		return obj;
	}, {});

	return [object_to_validate, object_annotated];
}

//execute the given chain of transformers and input values
//return a key value pair: field_name -> transformed value
function transformField(field_name, field, context)
{
	var columns = field.input;
	var data = {};

	if(columns != undefined)
	{
		//collect the input value
		data.value = columns.map(function(c){
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
			data = require(mod).transform(context,data.value);
		}
		catch(e)
		{
			console.log(e.stack); //probably transformer not found..
		}
	}

	var key = field_name;
	var result = {};
	result.resultcode = data.resultcode; 
	result[key] = data.value;
	return result;
}

//validates according to json-schema
function isValid(schema, object)
{
	var result = validate(object,schema);
	if(result.valid == false && log)
	{
		console.log("INVALID: " + result.schema.title + ": " + result.errors[0].stack);
		console.log(object);
		console.log("\n");
	}
	return result.valid;
}
