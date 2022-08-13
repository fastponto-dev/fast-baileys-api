import response from './../response.js'

const validate = (req, res, next) => {

    console.log('teste midware');

    if (!req.headers.authorization) {
        return response(res, 403, false, 'No token sent!')
    }

    if (req.headers.authorization != process.env.TOKEN) {
        return response(res, 401, false, 'Unauthorized')
    }

    next()
}

export default validate