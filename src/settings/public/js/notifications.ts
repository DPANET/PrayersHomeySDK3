import Noty from "noty";
export function notify(type: Noty.Type, message: string) {
    let noty: Noty = loadNotification();
    noty.setType(type, true);
    noty.setText(message, true);

    noty.show();
}
export function loadNotification(): Noty {
    return new Noty({
        layout: 'top',
        theme: "bootstrap-v4",
        type: "error", // success, error, warning, information, notification
        text: 'Test Hi', // [string|html] can be HTML or STRING
        force: false, // [boolean] adds notification to the beginning of queue when set to true      
        timeout: false, // [integer|boolean] delay for closing event in milliseconds. Set false for sticky notifications
        progressBar: false, // [boolean] - displays a progress bar
        animation: {
            open: 'animated slideInDown', // Animate.css class names
            close: 'animated slideOutUp' // Animate.css class names
        },
        closeWith: ['click', 'button'], // ['click', 'button', 'hover', 'backdrop'] // backdrop click will close all notifications
        modal: false, // [boolean] if true adds an overlay
        killer: false, // [boolean] if true closes all notifications and shows itself
    });
}
