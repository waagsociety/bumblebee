eventHandlers[ '#mapping' ] = { change: setConvertLink };

/**
 * Enables the convert button on the pre transform page
 */
function setConvertLink(){
  var url = location.href + '/transform/' + document.getElementById( 'mapping' ).value;
  document.getElementById('transform').removeAttribute("disabled");
  document.getElementById('transform').href = url;
}
