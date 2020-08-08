
var componentForm = {
  address: 'address',
  city: 'city',
  coordinates: 'coordinates',
  timezone: 'short_name',
  country: 'time-zone',
};
var autocomplete;
async function getKey()
{
  let key ="AIzaSyDRFzYIGVH_bYomwO0-f63mwc7PLaLZzu8";
let data;
  await $.ajax({
    url: `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`,
    // error: genericErrorHandler,
    type: "GET",
    dataType: "jsonp",
    processData:true,
    success: async (value) => {
      data =value;
      return data;
    },
}).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message) });
return data;
}
async function  initMap() {
  try{
    const existingScript = document.getElementById('googleMaps');
   // const key = await getKey();
    if (!existingScript) {
      var script = document.createElement('script');
      script.id = 'googleMaps';
     // script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
     let data =  await getKey();
           //script.src = $.parseHTML(await getKey());
      
      script.innerHTML =  data;
      script.type="text/javascript";

      document.body.appendChild(script );
      
    //  $.getScript(`${data}`,(data, textStatus, jqxhr) => {
        
        let searchinput = document.getElementById('search-input');
         autocomplete = new google.maps.places.Autocomplete(searchinput,{types:['(cities)']});
        autocomplete.addListener('place_changed', fillInAddress);
      //});
      if (existingScript && callback) callback();

    }
  }
    catch(err)
    {
      console.log(err)
    }
    
  
  }
initMap();

function fillInAddress()
{
  document.getElementById('search-button').click();
  // place= autocomplete.getPlace();
  // $("#city").val(place.formatted_address);
  // $("#coordinates").val(`(${place.geometry.location.lat()},${place.geometry.location.lng()})`);

}