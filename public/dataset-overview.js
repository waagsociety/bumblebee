eventHandlers[ '#mapping' ] = { change: setConvertLink };

function setConvertLink(){
  var url = location.href + '/transform/' + document.getElementById( 'mapping' ).value;
  document.getElementById('transform').removeAttribute("disabled");
  document.getElementById('transform').href = url;
}
