#!/usr/bin/env node

var fs = require('fs'),
	async = require('async'),
	byline = require('byline'),
	YAML = require('js-yaml'),
	validate = require('jsonschema').validate,
	csv = require('csv'),
	sqlite3 = require('sqlite3').verbose(),
	_ = require('underscore');

var log = false;

//Result resultcodes
ResultCode = {
	OK : 0, //transformation went okay, no errors
	FAIL : 1,//transformation failed
	DUPLICATE : 2 //transformation indicates duplicate key
};

var transformers = require('./transformers/');

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
//cb is called at every transformed row
//this function may be called from web application for example
function transformFile(path_schema, path_mapping, path_data, cb, done) {
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
		if(err) return cb(err);

		//process schema definitions, create tables if necessary	
		var schema = YAML.safeLoad(filesContents.path_schema),
			db_name = path_schema + ".db",
			db_cache = new sqlite3.Database(path_schema + ".db");//create or open (R/W) the cache database for the provided schema file
		
		return async.eachSeries(Object.keys(schema), createTable, tablesCreated);

		function createTable(entityName, cb){
			db_cache.run( createTableStatement( entityName, schema[entityName] ), cb );
		}

		function tablesCreated(err){
			//load mappings and data
			var mapping = YAML.safeLoad(filesContents.path_mapping),
				stream = byline(fs.createReadStream(path_data, { encoding: 'utf8' })),
				header = undefined;//the first line of data is expected to be a header 


			context.db_cache = db_cache;
			context.schema = schema;
			context.mapping = mapping;

			var pendingLines = 0,
				ended = false,
				allEntities = [];

			function processData(line) {
				if(header == undefined) {
					header = line.split(',');
					context.header = header;
					cb(null, { header: header });
				} else {
					pendingLines++;
					csv.parse(line,function(err, output){ //async
						context.data = output[0];

						processRow(context, lineDone);
					});
				}
			}
			
			//start data processing
			stream.on('data', processData);

			stream.on('end', end);

			function lineDone(err, entities){
				if(err) console.log(err);

				pendingLines--;
				allEntities.push.apply(allEntities, entities);

				cb(err, entities);
				
				if(ended && !pendingLines && done) done(null, allEntities);
			}

			function end(){
				ended = true;
			}
		}
	});

	return context;
}

//create a cache table for each schema found in the definition
//initializes the context variable
function createTableStatement(entityName, def) {
	//reduce the properties in each schema definition to a single create statement
	var statement = Object.keys(def["properties"]).reduce(function(prev,cur){
		var fieldName = cur; 
		var type = def["properties"][fieldName]["type"];
		return prev + fieldName + " " + type + ", ";

	},"CREATE TABLE IF NOT EXISTS " + entityName.replace('.','_') + "( ");

	statement = statement.slice(0, - 2);
	statement += " );"
	return statement;
}

//insert an object into the cache database
function createInsertStatement(object, def) {
	var statement = Object.keys(def["properties"]).reduce(function(prev,cur){
		var fieldName = cur; 
		var value = object[fieldName];
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
function processRow(context, cb) {
	return async.map(context.mapping, convertEntity, entitiesConverted);

	function convertEntity(container, cb){
		var keys = Object.keys(container),
			entityName = keys[0],
			entity = container[entityName];

		// set on context for use by transformer
		context.entityName = entityName;

		console.log(entityName, entity, container);

		transformEntity(entityName, entity, context, entityConverted);

		function entityConverted(err, convertedEntity){
			//schema for the given entity
			var schema = context.schema[entityName];
			
			//validate according to schema
			if(!isValid(schema, convertedEntity[0])){
				return cb();
			}

			convertedEntity[0].class = entityName; //inject this property for later use
			convertedEntity[1].class = entityName; //inject this property for later use

			var insert = createInsertStatement(convertedEntity[0], schema);

			context.db_cache.run(insert);

			if(log) console.log("create: " + YAML.safeDump(convertedEntity));

			cb(null, convertedEntity[1]);
		}
	}

	function entitiesConverted(err, results){
		results = _.compact(results);

		cb(err, results.length ? results : undefined);
	}
}

//transform the given entity and input values
//return one (or more) object that consists of key value pairs for each field
//or undefined if entity was not valid
//returns two copies of the object:
//the first is used for validation
//the second contains resultcodes for each field
function transformEntity(entityName, entity, context, cb) {
	// map the fields to their transformed counterparts
	return async.map(Object.keys(entity), transformEntityField, fieldsTransformed);

	function transformEntityField(fieldName, cb){
		transformField(fieldName, entity[fieldName], context, cb);
	}

	function fieldsTransformed(err, fields){
		var objectToValidate = {},
			objectAnnotated = {};

		fields.forEach(function(fieldData){
			var keys = Object.keys(fieldData);
			
			keys.splice(keys.indexOf('resultCode'), 1);
			
			var key = keys[0];

			objectToValidate[key] = fieldData[key];
			objectAnnotated[key] = fieldData;
		});

		cb(err, [objectToValidate, objectAnnotated]);
	}
}

//execute the given chain of transformers and input values
//return a key value pair: fieldName -> transformed value
function transformField(fieldName, field, context, cb) {
	var columns = field.input,
		data = {};

	// set on context for use by transformer
	context.fieldName = fieldName;

	if(columns) {
		//collect the input value
		data.value = columns.map(function(columnName) {
			var index = context.header.indexOf(columnName);

			return context.data[index];
		});
	}

	//execute the transformers chained together, input of the second is output of the first and so on
	return async.eachSeries(field.transformer, applyTransformation, afterChain);

	function applyTransformation(transformerName, cb){
		var transformerArguments = [context, data.value];

		if(transformerName.indexOf('(') > -1){
			var result = /\((.+)\)/.exec(transformerName),
				transformerParameter = result && result[1];

			transformerName = transformerName.split('(')[0];

			if(transformerParameter){
				transformerArguments.push(transformerParameter);
			}
		}

		transformerArguments.push(transformerCb);

		var transformer = transformers[transformerName];

		if(!transformer) throw('transformer ' + transformerName + ' not found');
		
		data = transformer.apply( null, transformerArguments );

		// synchronous transformers return data and don't call cb
		if(data) setImmediate(cb);

		function transformerCb(err, passedData){
			if(err) return cb(err);

			data = passedData;

			cb();
		}
	}

	function afterChain(err){
		var key = fieldName,
			result = {};

		if(!data) console.log('no data');

		result.resultCode = data.resultcode;
		result[key] = data.value;

		cb(err, result);
	}
}

//validates according to json-schema
function isValid(schema, object) {
	var result = validate(object, schema);
	if(result.valid == false && log) {
		console.log("INVALID: " + result.schema.title + ": " + result.errors[0].stack);
		console.log(object);
		console.log("\n");
	}

	return result.valid;
}
