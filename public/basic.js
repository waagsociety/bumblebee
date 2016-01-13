var socket,
    socketKey;

/**
 * used to iterate over objects, extends object prototype with method
 */
function createObjectIterator( method ) {
  return function( fun ) {
    var self = this;

    return Object.keys( self )[ method ]( iterate );

    function iterate( key ) {
      return fun( key, self[ key ], self );
    }
  };
}

/**
 * enables forEach, map and filter for objects
 */
Object.prototype.forEach = createObjectIterator( 'forEach' );
Object.prototype.map = createObjectIterator( 'map' );
Object.prototype.filter = createObjectIterator( 'filter' );

document.addEventListener( 'DOMContentLoaded', documentReady );

function documentReady(){
  initEventHandlers();
  if( window.initConnection ) initConnection();

  if( window.ZSchema ) validator = new ZSchema( { noEmptyStrings: true } );
}

var boundDelegates = {},
    eventHandlers = {};

/**
 * Binds every event handler setup in eventHandlers:
 * the key is the selector for the element, the value is an object,
 * of which each key is the event type and the values are handlers.
 * If element is found when this function runs, it adds an event listener,
 * otherwise it registers on the document and checks the clicked elements for the events
 */
function initEventHandlers(){
  eventHandlers.forEach( bindHandlersForElement );

  function bindHandlersForElement( nodeSelector, handlers ){
    var element = nodeSelector instanceof Element ? nodeSelector : document.querySelector( nodeSelector ) ;
    
    if( element ) handlers.forEach( bindEvent );
    else handlers.forEach( bindDelegate );

    function bindEvent( eventName, handler ){
      element.addEventListener( eventName, handler );
    }

    function bindDelegate( eventName, handler ){
      var boundDelegate = boundDelegates[ eventName ];
      
      if( !boundDelegate ) { // no delegate handler for this event type exists yet
        boundDelegate = boundDelegates[ eventName ] = {};
        document.addEventListener( eventName, createDelegateHandler( eventName ) );
      }

      boundDelegate[ nodeSelector ] = handler;
    }
  }

  /**
   * creates a generic handler that gets bound to the document,
   * bubbling up to trigger actions when handlers with selectors matching DOM elements are found
   */
  function createDelegateHandler( eventName ) {
    return function delegateEvent( e ){
      var delegates = boundDelegates[ eventName ],
          target = e.target,
          result = true, didAnyCancel;

      while( target && result ){
        didAnyCancel = Object.keys( delegates ).map( evaluateHandler );

        // handlers that return false prevent further bubbling up the chain
        result = didAnyCancel.indexOf( false ) === -1;

        // bubble up
        target = target.parentNode;
      }

      function evaluateHandler( nodeSelector ) {
        if( target.matches && target.matches( nodeSelector ) ) return delegates[ nodeSelector ].call( target, e );
      }
    };
  }
}

/**
 * gets or sets a property within a nested structure
 * example: to set a property 'a' to `true` on object 'bar' inside 'foo' of passed object,
 * object would be `{ foo: { bar: { } } }`, path would be 'foo.bar.a' and value would be `true`.
 * always returns value
 */
function resolveOnObject(object, path, value){
  var parts = path.split( '.' ),
      ref = object,
      part;

  while( parts.length > 1 && ref){
    part = parts.shift();
    ref = ref[part];
  }

  if(!ref) throw('declareOnObject: object does not contain ' + part + ', full path given: ' + path);

  part = parts.shift();

  if(value !== undefined) ref[part] = value;
  
  return ref[part];
}

/**
 * Same as resolveOnObject except it uses delete to remove a property
 */
function unsetOnObject( object, path ) {
  var parts = path.split( '.' ),
      ref = object,
      part;

  while( parts.length > 1 && ref){
    part = parts.shift();
    ref = ref[part];
  }

  if(!ref) throw('declareOnObject: object does not contain ' + part + ', full path given: ' + path);

  part = parts.shift();

  return delete ref[part];
}

