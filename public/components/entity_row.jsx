if(React == undefined)
{
	var React = require('react');
}

var EntityRow = React.createClass({
		render: function() { 
			var rows = [];
			for (var i=0; i < this.props.values.length; i++)
			{
				var column_name = this.props.columns[i];
				var column_value = this.props.values[i];

				rows.push(
					<td key={column_name}><input type="text" name={column_name} defaultValue={column_value} /></td>
				);
			}
			return (<tr>{rows}</tr>);
		}
});

//transform a schema object to a properties object for the entity table
function entityRowProps(input)
{
	var columns = Object.keys(input).filter(function(key){return (key != "class");});
	var values = columns.map(function(name){return input[name][name];});
	var statuses = columns.map(function(name){return input[name].resultcode;});

	var props = {
		"class" : input.class,
		"columns" : columns,
		"values" : values,
	        "status" : statuses,
		"key" : values[0] //HACK: We ALWAYS expect the first value to be the key value	
	};

	return props;	
}

if(module == undefined)
{}
else{
	module.exports = {
		EntityRow : EntityRow,
		entityRowProps : entityRowProps
	};
}

