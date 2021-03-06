"use strict";
console.log("Loading function");
var request = require("request");
var https = require("https");
var async = require("async");
var amazon_api = require("amazon-product-api");
var config = require("config");

var PAGE_ACCESS_TOKEN;
var MESSENGER_VALIDATION_TOKEN;

var RECIPIENT_ID;

var amazon_client = amazon_api.createClient(config.get("amazonCredentials"));

exports.handle = function(event, context, callback){
    console.log("Event:", JSON.stringify(event, null, 2));
    MESSENGER_VALIDATION_TOKEN = event["stage-variables"]["MESSENGER_VALIDATION_TOKEN"] || "swordfish";
    PAGE_ACCESS_TOKEN          = event["stage-variables"]["PAGE_ACCESS_TOKEN"] ;

    var method = event.context["http-method"];
    var response = "";
    var queryparams = event.params.querystring;

    if(method === "GET"){
        if(queryparams["hub.mode"] === "subscribe" && queryparams["hub.verify_token"] === MESSENGER_VALIDATION_TOKEN){
          response = queryparams["hub.challenge"];
        }else{
          response ="Incorrect verify token";
        }
        callback(null, response);//return the challenge
    }else{
        if(method === "POST"){
            //console.log("Post Event", JSON.stringify(event, null, 2));
            var messageEntries = event["body-json"]["entry"];
            for(var entryIndex in messageEntries){
                var messageEntry = messageEntries[entryIndex].messaging;
                for(var messageIndex in messageEntry){
                    var message = messageEntry[messageIndex];
                    if(message.message !== undefined  && message.message["is_echo"] !== true){
                        itemSearch(message.message.text, message.sender.id, respond);
                    }else if(message.postback !== undefined && message.postback.payload !== undefined){
                        var payload = message.postback.payload;
                        payload = JSON.parse(payload);
                        
                        if(payload.METHOD !== undefined){
                            if(payload.METHOD == "ADD_TO_CART"){
                                if(payload.ASIN !== undefined){
                                    cartCreate(payload.ASIN, 1, message.sender.id, respond);
                                }
                            }else if(payload.METHOD == "VARIATION_PICK"){

                            }
                        }
                    }
                }
            }
        }
    }
};


function itemSearch(keywords, recipientId, callback){
    amazon_client.itemSearch({
        "searchIndex" : "All",
        "keywords" : keywords,
        "responseGroup" : "ItemIds"
    }, function(err, res){
        if(err){
            console.log("err:", JSON.stringify(err, null, 2));
        }
        //Only check the first item form the list
        for(var itemIdx = 0; itemIdx < Math.min(res.length, 1); itemIdx++){
            var curItem = res[itemIdx];
            //When item has ParentASIN, which means has options
            if(curItem["ParentASIN"] !== undefined && curItem["ParentASIN"].length > 0){
                itemPick(curItem["ParentASIN"][0], [], recipientId, callback);
            }
            //When item doesn't have ParentASIN, which means has no options
            else if(curItem["ASIN"] !== undefined && curItem["ASIN"].length > 0){
                itemDetail(curItem["ASIN"][0], recipientId, callback);
            }
        }
    });
};

//TODO Add price display and quantity paramater
function itemDetail(ASIN, recipientId, callback){
    var message = {
        "attachment" : {
            "type" : "template",
            "payload" : {
                "template_type" : "generic",
                "elements" : []
            }
        }
    };

    amazon_client.itemLookup({
        "ItemId" : ASIN,
        "IdType" : "ASIN",
        "responseGroup" : ["ItemAttributes","Images","ItemIds","OfferSummary"]
    }, function(err, res){
        if(err){
            console.log("ItemLookup Error:", JSON.stringify(err, null, 2));
        }else if(res){
            console.log("ITEM DETAIL:", JSON.stringify(res, null, 2));
            var curItem = res[0];
            var itemDetail = {};

            if(curItem.ItemAttributes !== undefined && curItem.ItemAttributes.length > 0){
                if(curItem.ItemAttributes[0].Title != undefined && curItem.ItemAttributes[0].Title.length > 0){
                    itemDetail.title = curItem.ItemAttributes[0].Title[0];
                }
            }

            if(curItem.DetailPageURL !== undefined && curItem.DetailPageURL.length > 0){
                itemDetail.item_url = curItem.DetailPageURL[0];
            }

            if(curItem.LargeImage !== undefined && curItem.LargeImage.length > 0){
                if(curItem.LargeImage[0].URL !== undefined && curItem.LargeImage[0].URL.length > 0){
                    itemDetail.image_url = curItem.LargeImage[0].URL[0];
                }
            }

            if(curItem.ASIN != undefined && curItem.ASIN.length > 0){
                var payload = {
                    "METHOD" : "ADD_TO_CART",
                    "ASIN" : curItem.ASIN[0],
                };

                itemDetail.buttons = [
                    {
                        "type" : 'postback',
                        "title" : 'Add to Cart',
                        "payload" : JSON.stringify(payload)
                    }
                ];
            }
            message.attachment.payload.elements.push(itemDetail);

            callback(null, recipientId, message);
        }
    });
}

itemDetail("B00TZR3WRM", 1112867895435780, respond);


//itemSearch("asics", 1112867895435780, respond);

function itemPick(ASIN, variationValues, recipientId, callback){
    var message = {
        "attachment" : {
            "type" : "template",
            "payload" : {
                "template_type" : "button",
                "text" : "Pick a Size",
                "buttons" : []
            }
        }
    }

    var temp = itemVariation(ASIN);
    console.log(temp);
    //var [keys, map] = itemVariation(ASIN);
    

    // console.log(keys);
    // console.log(map);


    // for(var key of Object.keys(map)){
    //     message["attachment"]["payload"]["buttons"].push({
    //         "type" : "postback",
    //         "title" : key,
    //         "payload" : "VARIATION_"+variationKeys[0]+"_"+key,
    //     })
    //     if(message["attachment"]["payload"]["buttons"].length == 3){
    //         callback(null, recipientId, message);
    //         message["attachment"]["payload"]["buttons"] = [];
    //     }
    // }
    // if(message["attachment"]["payload"]["buttons"].length != 0){
    //     callback(null, recipientId, message);
    // }

}

function itemVariation(ASIN){
    amazon_client.itemLookup({
        "ItemId" : ASIN,
        "IdType" : "ASIN",
        "ResponseGroup" : "Variations"
    }, function(err, res){
        if(err){
            console.log("ItemLookup Error:", JSON.stringify(err, null, 2));
        }else if(res){
            //console.log("ItemLookup Response:", JSON.stringify(res, null, 2));
            if(res[0]["Variations"] !== undefined && res[0]["Variations"].length > 0 
                && res[0]["Variations"][0]["VariationDimensions"] !== undefined 
                && res[0]["Variations"][0]["VariationDimensions"].length > 0
                && res[0]["Variations"][0]["VariationDimensions"][0]["VariationDimension"] != undefined
                && res[0]["Variations"][0]["VariationDimensions"][0]["VariationDimension"].length > 0){

                var map = {};
                var variationKeys = res[0].Variations[0].VariationDimensions[0].VariationDimension;

                if(res[0].Variations[0].Item !== undefined && res[0].Variations[0].Item.length > 0){
                    var items = res[0].Variations[0].Item;
                    for(var idx = 0; idx < items.length; ++idx){
                        var item = items[idx];
                        var ref = map;
                        if(item["ItemAttributes"] !== undefined && item["ItemAttributes"].length > 0){
                            var itemAttributes = item["ItemAttributes"][0];
                            for(var variationIdx in variationKeys){
                                var variation = variationKeys[variationIdx];
                                var value = itemAttributes[variation][0];
                                if(!(value in ref)){
                                    if(variationIdx == variationKeys.length - 1){
                                        ref[value] = {
                                            "ASIN" : item.ASIN[0],
                                            "Image:" : item.LargeImage[0].URL[0]
                                        }                
                                    }else{
                                        ref[value] = {};
                                        ref = ref[value];
                                    }
                                }else{
                                    ref = ref[value];
                                }
                            }
                        }
                    }
                    return [variationKeys, map];
                }else{
                    console.log("This item no Variatios item is empty")    
                }
            }else{
                console.log("This item no Variatios")
            }
        }
    });
};

function cartCreate(ASIN, quantity, recipientId, callback){
    var message = {
        "attachment" : {
            "type" : "template",
            "payload" : {
                "template_type" : "generic",
                "elements" : [
                    {
                        "title" : "Item added to the cart",
                        "buttons" : [
                            {
                                "type" : "web_url",
                                "url" : null,
                                "title" : "Check Out",
                            }
                        ]
                    }
                ]
            }
        }
    };

    amazon_client.cartCreate({
        "Item.1.ASIN" : ASIN,
        "Item.1.Quantity" : quantity
    }, function(err, res){
        if(err){
            console.log("Cart Create Error:", JSON.stringify(err, null, 2));
        }else if(res.CartItems !== undefined && res.CartItems.length > 0){
            //console.log("Cart Create Success:", JSON.stringify(res, null, 5));
            message.attachment.payload.elements[0].buttons[0].url = res.PurchaseURL[0];
            // for(var key in res.CartItems[0]){  ///TODO Cart could more than one product
            //     if(key == "CartItem"){
            //         //console.log("price:", res.CartItems[0][key][0].Price[0].Amount[0]);
            //         var item = {
            //             "title" : res.CartItems[0][key][0].Title[0],
            //             "quantity" : res.CartItems[0][key][0].Quantity[0],
            //             "price" : res.CartItems[0][key][0].Price[0].Amount[0],
            //             "currency" : res.CartItems[0][key][0].Price[0].CurrencyCode[0]
            //         }
            //         message.attachment.payload.elements.push(item);
            //     }
            // };
            // message.attachment.payload.order_url = res.PurchaseURL[0];
            // message.attachment.payload.summary = {
            //     "total_cost" : res.SubTotal[0].Amount[0]
            // }
            //console.log("MESSAGE:", message);
            callback(null, recipientId, message);
        }
    });
}


function respond(err, recipientId, message){
    var messageData = {};
    messageData.recipient = {id:recipientId};
    messageData.message = message;
    
    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: { access_token: PAGE_ACCESS_TOKEN },
        method: 'POST',
        json: messageData
    }, function (error, response, body) {
        if(!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;
            if(messageId) {
                console.log("Message %s delivered to recipient %s", messageId, recipientId);
            }else{
                console.log("Message sent to recipient %s", recipientId);
            }
        }else{
            //console.error(response.error);
            //console.log(error);
            console.log("Facebook Request failed    : " + JSON.stringify(response, null, 2));
            console.log("Message Data that was sent : " + JSON.stringify(messageData, null, 2));
        }
    });
}