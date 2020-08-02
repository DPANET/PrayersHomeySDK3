export  class HttpException extends Error {
    status: number;
    message: string;
    constructor(status: number, message: string) {
      super(message);

    }
}


export class UserWithThatEmailAlreadyExistsException extends HttpException
{    
  constructor( email: string) {
    super(404, `user with email ${email} not found`);

  }
}

export class  WrongCredentialsException extends HttpException{

  constructor() {
    super(404, `Wrong Password provided`);

  }
}

export class PostNotFoundException extends HttpException {
  constructor(id: string) {
    super(404, `Post with id ${id} not found`);
  }
}

export class AuthenticationTokenMissingException extends HttpException
{
  constructor()
  {
    super(404,'Authentication Token Missing');
  }
}

export class WrongAuthenticationTokenException extends HttpException
{
  constructor()
  {
    super(404,'Authentication Token Missing');
  }
}
